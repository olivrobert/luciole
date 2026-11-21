<?php

declare(strict_types=1);

namespace Library\Domain\Model;

use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\Phone;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\ORM\Mapping as ORM;
use Identity\Domain\Model\Administrator;
use Identity\Domain\Model\User;
use Library\Domain\Enum\AccountStatus;
use SharedKernel\Domain\Model\Country;

#[ORM\Entity]
#[ORM\Table(name: 'library')]
class Library implements \Stringable
{
    use IdentityTrait;
    use TimestampableTrait;

    #[ORM\OneToOne(targetEntity: User::class, mappedBy: 'library')]
    private ?User $user = null;

    #[ORM\Column(length: 20, enumType: AccountStatus::class)]
    public private(set) AccountStatus $accountStatus;

    #[ORM\Column]
    public private(set) \DateTimeImmutable $requestDate;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $processingDate = null;

    #[ORM\ManyToOne(targetEntity: Administrator::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Administrator $processedBy = null;

    #[ORM\Column(length: 255)]
    public private(set) string $lastName;

    #[ORM\Column(length: 255)]
    public private(set) string $firstName;

    #[ORM\Column(type: 'phone', length: 20)]
    public private(set) Phone $phone;

    #[ORM\Column(length: 255)]
    public private(set) string $companyName;

    #[ORM\Column(length: 255)]
    public private(set) string $address;

    #[ORM\Column(length: 255)]
    public private(set) string $city;

    #[ORM\Column(length: 20)]
    public private(set) string $postalCode;

    #[ORM\ManyToOne(targetEntity: Country::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Country $country = null;

    public function __construct(
        string $lastName,
        string $firstName,
        string $phone,
        string $companyName,
        string $address,
        string $city,
        string $postalCode,
        ?Country $country,
    ) {
        $this->lastName = $lastName;
        $this->firstName = $firstName;
        $this->phone = Phone::fromString($phone);
        $this->companyName = $companyName;
        $this->address = $address;
        $this->city = $city;
        $this->postalCode = $postalCode;
        $this->country = $country;
        $this->accountStatus = AccountStatus::Pending;
        $this->requestDate = new \DateTimeImmutable();
    }

    public function approve(Administrator $processedBy): void
    {
        if (AccountStatus::Pending !== $this->accountStatus) {
            throw new \LogicException('Only a pending library can be approved.');
        }

        $this->accountStatus = AccountStatus::Approved;
        $this->processingDate = new \DateTimeImmutable();
        $this->processedBy = $processedBy;
    }

    public function reject(Administrator $processedBy): void
    {
        if (AccountStatus::Pending !== $this->accountStatus) {
            throw new \LogicException('Only a pending library can be rejected.');
        }

        $this->accountStatus = AccountStatus::Rejected;
        $this->processingDate = new \DateTimeImmutable();
        $this->processedBy = $processedBy;
    }

    public function disable(): void
    {
        if (AccountStatus::Approved !== $this->accountStatus) {
            throw new \LogicException('Only an approved library can be disabled.');
        }

        $this->accountStatus = AccountStatus::Disabled;
    }

    public function reactivate(): void
    {
        $this->accountStatus = AccountStatus::Approved;
    }

    public function isPending(): bool
    {
        return AccountStatus::Pending === $this->accountStatus;
    }

    public function isDisabled(): bool
    {
        return AccountStatus::Disabled === $this->accountStatus;
    }

    public function getUser(): ?User
    {
        return $this->user;
    }

    public function setUser(?User $user): void
    {
        $this->user = $user;
    }

    #[\Override]
    public function __toString(): string
    {
        return $this->companyName.' ('.$this->firstName.' '.$this->lastName.')';
    }
}
