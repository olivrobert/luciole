<?php

declare(strict_types=1);

namespace Mediatheque\Domain\Model;

use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\Telephone;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\ORM\Mapping as ORM;
use Identite\Domain\Model\Administrateur;
use Identite\Domain\Model\Utilisateur;
use Mediatheque\Domain\Enum\StatutCompte;
use SharedKernel\Domain\Model\Pays;

#[ORM\Entity]
#[ORM\Table(name: 'mediatheque')]
class Mediatheque implements \Stringable
{
    use IdentityTrait;
    use TimestampableTrait;

    #[ORM\OneToOne(targetEntity: Utilisateur::class, mappedBy: 'mediatheque')]
    private ?Utilisateur $utilisateur = null;

    #[ORM\Column(length: 20, enumType: StatutCompte::class)]
    public private(set) StatutCompte $statutCompte;

    #[ORM\Column]
    public private(set) \DateTimeImmutable $dateDemande;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $dateTraitement = null;

    #[ORM\ManyToOne(targetEntity: Administrateur::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Administrateur $processedBy = null;

    #[ORM\Column(length: 255)]
    public private(set) string $nom;

    #[ORM\Column(length: 255)]
    public private(set) string $prenom;

    #[ORM\Column(type: 'telephone', length: 20)]
    public private(set) Telephone $telephone;

    #[ORM\Column(length: 255)]
    public private(set) string $raisonSociale;

    #[ORM\Column(length: 255)]
    public private(set) string $adresse;

    #[ORM\Column(length: 255)]
    public private(set) string $ville;

    #[ORM\Column(length: 20)]
    public private(set) string $codePostal;

    #[ORM\ManyToOne(targetEntity: Pays::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Pays $pays = null;

    public function __construct(
        string $nom,
        string $prenom,
        string $telephone,
        string $raisonSociale,
        string $adresse,
        string $ville,
        string $codePostal,
        ?Pays $pays,
    ) {
        $this->nom = $nom;
        $this->prenom = $prenom;
        $this->telephone = Telephone::fromString($telephone);
        $this->raisonSociale = $raisonSociale;
        $this->adresse = $adresse;
        $this->ville = $ville;
        $this->codePostal = $codePostal;
        $this->pays = $pays;
        $this->statutCompte = StatutCompte::EnAttente;
        $this->dateDemande = new \DateTimeImmutable();
    }

    public function approve(Administrateur $processedBy): void
    {
        if (StatutCompte::EnAttente !== $this->statutCompte) {
            throw new \LogicException('Seule une médiathèque en attente peut être validée.');
        }

        $this->statutCompte = StatutCompte::Valide;
        $this->dateTraitement = new \DateTimeImmutable();
        $this->processedBy = $processedBy;
    }

    public function reject(Administrateur $processedBy): void
    {
        if (StatutCompte::EnAttente !== $this->statutCompte) {
            throw new \LogicException('Seule une médiathèque en attente peut être refusée.');
        }

        $this->statutCompte = StatutCompte::Refuse;
        $this->dateTraitement = new \DateTimeImmutable();
        $this->processedBy = $processedBy;
    }

    public function desactiver(): void
    {
        if (StatutCompte::Valide !== $this->statutCompte) {
            throw new \LogicException('Seule une médiathèque validée peut être désactivée.');
        }

        $this->statutCompte = StatutCompte::Desactive;
    }

    public function reactiver(): void
    {
        $this->statutCompte = StatutCompte::Valide;
    }

    public function isEnAttente(): bool
    {
        return StatutCompte::EnAttente === $this->statutCompte;
    }

    public function isDesactive(): bool
    {
        return StatutCompte::Desactive === $this->statutCompte;
    }

    public function getUtilisateur(): ?Utilisateur
    {
        return $this->utilisateur;
    }

    public function setUtilisateur(?Utilisateur $utilisateur): void
    {
        $this->utilisateur = $utilisateur;
    }

    #[\Override]
    public function __toString(): string
    {
        return $this->raisonSociale.' ('.$this->prenom.' '.$this->nom.')';
    }
}
