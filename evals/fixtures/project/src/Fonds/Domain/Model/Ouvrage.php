<?php

declare(strict_types=1);

namespace Fonds\Domain\Model;

use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Editeur\Domain\Model\Editeur;
use Fonds\Domain\Enum\StatutOuvrage;
use Fonds\Domain\Model\Embeddable\Isbn;
use SharedKernel\Domain\Model\TranslatableText;

#[ORM\Entity]
#[ORM\Table(name: 'ouvrage')]
class Ouvrage
{
    use IdentityTrait;
    use TimestampableTrait;

    #[ORM\Embedded(class: TranslatableText::class, columnPrefix: 'titre_')]
    public private(set) TranslatableText $titre;

    #[ORM\Embedded(class: Isbn::class, columnPrefix: false)]
    public private(set) Isbn $isbn;

    #[ORM\ManyToOne(targetEntity: Editeur::class, inversedBy: 'ouvrages')]
    #[ORM\JoinColumn(name: 'editeur_id', referencedColumnName: 'id')]
    public private(set) Editeur $editeur;

    /** @var Collection<int, Exemplaire> */
    #[ORM\OneToMany(targetEntity: Exemplaire::class, mappedBy: 'ouvrage')]
    public private(set) Collection $exemplaires;

    #[ORM\Column(length: 20, enumType: StatutOuvrage::class)]
    public private(set) StatutOuvrage $statut;

    public function __construct(TranslatableText $titre, Isbn $isbn, Editeur $editeur)
    {
        $this->titre = $titre;
        $this->isbn = $isbn;
        $this->editeur = $editeur;
        $this->exemplaires = new ArrayCollection();
        $this->statut = StatutOuvrage::Brouillon;
    }

    public function publier(): void
    {
        if (StatutOuvrage::Brouillon !== $this->statut) {
            throw new \LogicException('Seul un ouvrage en brouillon peut être publié.');
        }

        $this->statut = StatutOuvrage::Publie;
    }

    public function renommer(TranslatableText $titre): void
    {
        $this->titre = $titre;
    }
}
