<?php

declare(strict_types=1);

namespace Catalog\Domain\Model;

use Catalog\Domain\Enum\BookStatus;
use Catalog\Domain\Model\Embeddable\Isbn;
use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Publisher\Domain\Model\Publisher;
use SharedKernel\Domain\Model\TranslatableText;

#[ORM\Entity]
#[ORM\Table(name: 'book')]
class Book
{
    use IdentityTrait;
    use TimestampableTrait;

    #[ORM\Embedded(class: TranslatableText::class, columnPrefix: 'title_')]
    public private(set) TranslatableText $title;

    #[ORM\Embedded(class: Isbn::class, columnPrefix: false)]
    public private(set) Isbn $isbn;

    #[ORM\ManyToOne(targetEntity: Publisher::class, inversedBy: 'books')]
    #[ORM\JoinColumn(name: 'publisher_id', referencedColumnName: 'id')]
    public private(set) Publisher $publisher;

    /** @var Collection<int, BookCopy> */
    #[ORM\OneToMany(targetEntity: BookCopy::class, mappedBy: 'book')]
    public private(set) Collection $bookCopies;

    #[ORM\Column(length: 20, enumType: BookStatus::class)]
    public private(set) BookStatus $status;

    public function __construct(TranslatableText $title, Isbn $isbn, Publisher $publisher)
    {
        $this->title = $title;
        $this->isbn = $isbn;
        $this->publisher = $publisher;
        $this->bookCopies = new ArrayCollection();
        $this->status = BookStatus::Draft;
    }

    public function publish(): void
    {
        if (BookStatus::Draft !== $this->status) {
            throw new \LogicException('Only a draft book can be published.');
        }

        $this->status = BookStatus::Published;
    }

    public function rename(TranslatableText $title): void
    {
        $this->title = $title;
    }
}
